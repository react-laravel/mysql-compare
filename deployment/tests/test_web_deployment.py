import unittest,importlib.util,pathlib,tempfile,tarfile,io,json,hashlib,os,sys
from unittest.mock import patch
BASE=pathlib.Path(__file__).resolve().parents[2]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
pub=load('mysqlpub',BASE/'deployment/publish-mysql-compare.py');gateway=load('mysqlgate',BASE/'deployment/mysql-compare-ssh-gateway.py');client=load('mysqlclient',BASE/'scripts/mysql-web-ci.py')
OLD='a'*40;NEW='b'*40
class PackageTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.rel=self.root/'releases';self.rel.mkdir();self.inc=self.root/'incoming';self.inc.mkdir();(self.rel/OLD).mkdir();(self.rel/OLD/'keep').write_text('original');(self.rel/'current').symlink_to(OLD);self.patches=[patch.object(pub,'RELEASES',self.rel),patch.object(pub,'INCOMING',self.inc),patch.object(pub,'MIN_FREE_DISK',0)]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def archive(self,mutation=None):
  files={n:b'fixture' for n in pub.ROOT_REQUIRED};manifest={'schema':1,'application':'mysql-compare-web','revision':NEW,'source_revision':'c'*40,'workflow_revision':'d'*40,'files':{n:hashlib.sha256(b).hexdigest() for n,b in files.items()}};members=[(n,b,None) for n,b in files.items()]
  if mutation:mutation(manifest,members)
  members.append(('deploy-manifest.json',json.dumps(manifest).encode(),None));p=self.inc/(NEW+'.tar.gz')
  with tarfile.open(p,'w:gz') as t:
   for name,data,kind in members:
    i=tarfile.TarInfo(name);i.size=len(data);i.mode=0o644
    if kind:i.type=kind;i.linkname='/etc/passwd';i.size=0
    t.addfile(i,io.BytesIO(data) if not kind else None)
  return p
 def test_good_package_roundtrip_and_manifest_provenance(self):
  a=self.archive();e=pub.inspect_archive(a,NEW);stage=self.root/'out';stage.mkdir();pub.extract_archive(a,stage,e);self.assertEqual(json.loads((stage/'deploy-manifest.json').read_text())['application'],'mysql-compare-web')
 def test_wrong_application_rejected(self):
  with self.assertRaises(pub.DeployError):pub.inspect_archive(self.archive(lambda m,f:m.update(application='upyun-web')),NEW)
 def test_wrong_revision_rejected(self):
  with self.assertRaises(pub.DeployError):pub.inspect_archive(self.archive(lambda m,f:m.update(revision=OLD)),NEW)
 def test_missing_entry_rejected(self):
  def change(m,f):f.pop(0);m['files'].pop(next(iter(m['files'])))
  with self.assertRaises(pub.DeployError):pub.inspect_archive(self.archive(change),NEW)
 def test_escape_rejected(self):
  with self.assertRaises(pub.DeployError):pub.inspect_archive(self.archive(lambda m,f:f.append(('../escape',b'x',None))),NEW)
 def test_symlink_rejected(self):
  with self.assertRaises(pub.DeployError):pub.inspect_archive(self.archive(lambda m,f:f.append(('src/link',b'',tarfile.SYMTYPE))),NEW)
 def test_env_rejected(self):
  with self.assertRaises(pub.DeployError):pub.inspect_archive(self.archive(lambda m,f:f.append(('src/.env',b'x',None))),NEW)
 def test_changed_payload_checksum_rejected(self):
  a=self.archive(lambda m,f:m['files'].update({'src/web/index.mjs':'0'*64}));e=pub.inspect_archive(a,NEW);stage=self.root/'out';stage.mkdir()
  with self.assertRaises(pub.DeployError):pub.extract_archive(a,stage,e)
 def test_busy_refuses_and_old_current_unchanged(self):
  self.archive()
  with patch.object(pub,'wait_for_idle',side_effect=pub.DeployError('busy')),patch.object(pub,'restart_services') as restart:
   with self.assertRaises(pub.DeployError):pub.publish(NEW)
  self.assertEqual(pub.current_release(),OLD);self.assertEqual((self.rel/OLD/'keep').read_text(),'original');self.assertFalse((self.rel/NEW).exists());restart.assert_not_called()
 def test_failed_health_restores_old_current(self):
  self.archive()
  with patch.object(pub,'wait_for_idle'),patch.object(pub,'restart_services') as restart,patch.object(pub,'wait_for_health',side_effect=pub.DeployError('health')):
   with self.assertRaises(pub.DeployError):pub.publish(NEW)
  self.assertEqual(pub.current_release(),OLD);self.assertEqual(restart.call_count,2);self.assertFalse((self.rel/NEW).exists())
 def test_success_only_one_version_data_outside_untouched(self):
  data=self.root/'data';data.write_text('secret-fixture');self.archive()
  with patch.object(pub,'wait_for_idle'),patch.object(pub,'restart_services'),patch.object(pub,'wait_for_health'):pub.publish(NEW)
  self.assertEqual(pub.current_release(),NEW);self.assertFalse((self.rel/OLD).exists());self.assertEqual(data.read_text(),'secret-fixture');self.assertFalse(any(self.inc.iterdir()))
 def test_duplicate_member_rejected(self):
  with self.assertRaises(pub.DeployError):pub.inspect_archive(self.archive(lambda m,f:f.append(f[0])),NEW)
class SocketAndGateway(unittest.TestCase):
 def test_only_runtime_uid_established_sockets_count(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'tcp';p.write_text('header\n0: a b 01 a b c 123 0\n1: a b 01 a b c 999 0\n2: a b 0A a b c 123 0\n');self.assertEqual(pub.connection_count(123,(p,)),1)
 def test_busy_wait_and_quiet_window(self):
  with patch.object(pub.pwd,'getpwnam') as user,patch.object(pub.time,'sleep'),patch.object(pub,'connection_count',side_effect=[0,0,1,0,0,0,0,0]) as counter:user.return_value.pw_uid=123;pub.wait_for_idle();self.assertEqual(counter.call_count,8)
 def test_busy_eventually_refuses(self):
  with patch.object(pub.pwd,'getpwnam') as user,patch.object(pub.time,'sleep'),patch.object(pub,'connection_count',return_value=1):
   user.return_value.pw_uid=123
   with self.assertRaises(pub.DeployError):pub.wait_for_idle()
 def test_gateway_exact_only(self):
  for command in ['receive','publish','validate']:self.assertEqual(gateway.parse_command(command+' '+NEW),(command,NEW))
  for bad in ['bash','cat /etc/mysql-compare/runtime-env.json','sudo systemctl restart squid','publish '+NEW+'\nwhoami','validate '+NEW+' ','receive ../../x']:
   with self.assertRaises(ValueError):gateway.parse_command(bad)
class HostedClient(unittest.TestCase):
 def test_check_only_never_uploads(self):
  calls=[]
  with patch.dict(os.environ,{'B_MYSQL_COMPARE_DEPLOY_SSH_KEY':'fixture-key','B_MYSQL_COMPARE_DEPLOY_KNOWN_HOSTS':'fixture-host'}),patch.object(sys,'argv',['ci','deploy','--revision',NEW,'--archive','not-needed','--check-only']),patch.object(client,'run',side_effect=lambda args,**kw:calls.append(args) or b''):client.main()
  self.assertEqual(len(calls),1);self.assertEqual(calls[0][-1],'validate '+NEW)
 def test_stale_push_rejected_before_dispatch(self):
  with patch.dict(os.environ,{'GITHUB_REPOSITORY':client.REPO,'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/electron','GITHUB_SHA':OLD}),patch.object(client,'api',return_value={'object':{'sha':NEW}}):
   with self.assertRaises(RuntimeError):self.run_select()
 def run_select(self):
  with patch.object(sys,'argv',['ci','select']):client.main()
if __name__=='__main__':unittest.main(verbosity=2)
