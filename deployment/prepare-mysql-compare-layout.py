#!/usr/bin/python3
"""Root installation proposal. Requires a caller-supplied public key after approval."""
import pathlib,os,pwd,grp,json,subprocess,re,stat,hashlib,sys
APP=pathlib.Path('/var/www/mysql-compare');REL=APP/'releases';STATE=pathlib.Path('/var/lib/mysql-compare-deploy');USER='mysql-compare-deploy';RUNTIME='mysql-compare'
def command(args):
 r=subprocess.run(args,capture_output=True,text=True,timeout=30);assert r.returncode==0,'Scoped layout command failed';return r.stdout
assert os.geteuid()==0 and len(sys.argv)==3
key=pathlib.Path(sys.argv[1]).read_text().strip();assert re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]+)?',key)
helpers=pathlib.Path(sys.argv[2]);assert helpers.is_dir();assert not STATE.exists()
for p in [pathlib.Path('/usr/local/libexec/publish-mysql-compare'),pathlib.Path('/usr/local/libexec/mysql-compare-ssh-gateway'),pathlib.Path('/etc/sudoers.d/mysql-compare-deploy')]:assert not p.exists()
try:pwd.getpwnam(USER)
except KeyError:pass
else:raise RuntimeError('Deploy account already exists; inspect its prior state')
assert APP.is_dir() and not APP.is_symlink() and APP.stat().st_uid==0 and APP.stat().st_mode&0o022==0
cur=APP/'current';assert cur.is_symlink();old=cur.resolve();assert old.parent==REL and re.fullmatch('[0-9a-f]{40}',old.name)
assert sorted(p.name for p in REL.iterdir())==[old.name]
m=json.loads((old/'deploy-manifest.json').read_text())
for name,digest in m['files'].items():
 p=old/name;assert p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==digest
before=command(['systemctl','show','mysql-compare.service','-p','MainPID','--value']).strip();assert int(before)>0
command(['useradd','--system','--home-dir',str(STATE),'--create-home','--shell','/bin/bash','--user-group',USER]);command(['usermod','-L',USER]);deploy=pwd.getpwnam(USER);runtime=pwd.getpwnam(RUNTIME)
assert set(os.getgrouplist(USER,deploy.pw_gid))=={deploy.pw_gid} and runtime.pw_gid!=deploy.pw_gid
STATE.chmod(0o755);os.chown(STATE,0,0)
for file in ['.bashrc','.profile','.bash_profile','.ssh/rc']:
 p=STATE/file
 if p.exists():
  assert p.is_file() and not p.is_symlink();os.chown(p,0,0);p.chmod(0o644)
private=['/etc/mysql-compare/runtime-env.json','/var/lib/mysql-compare/data','/proc/'+before+'/environ','/proc/'+before+'/mem','/etc/ssh/ssh_host_ed25519_key']
for p in private:
 assert subprocess.run(['runuser','-u',USER,'--','test','-r',p],capture_output=True).returncode!=0,'Deployment account could read a private runtime path'
for folder,dirs,files in os.walk(old):
 p=pathlib.Path(folder);assert not p.is_symlink();os.chown(p,deploy.pw_uid,deploy.pw_gid);p.chmod(0o755)
 for name in files:
  p=pathlib.Path(folder)/name;assert p.is_file() and not p.is_symlink();os.chown(p,deploy.pw_uid,deploy.pw_gid);p.chmod(0o644)
os.chown(REL,deploy.pw_uid,deploy.pw_gid);REL.chmod(0o755)
inner=REL/'current';os.symlink(old.name,inner);os.lchown(inner,deploy.pw_uid,deploy.pw_gid)
temp=APP/'.mysql-current-install';assert not temp.exists();os.symlink('releases/current',temp);os.replace(temp,cur)
incoming=STATE/'incoming';incoming.mkdir(mode=0o700);os.chown(incoming,deploy.pw_uid,deploy.pw_gid);lock=STATE/'publish.lock';lock.touch(mode=0o600);os.chown(lock,deploy.pw_uid,deploy.pw_gid)
for name,target in [('publish-mysql-compare.py','/usr/local/libexec/publish-mysql-compare'),('mysql-compare-ssh-gateway.py','/usr/local/libexec/mysql-compare-ssh-gateway')]:
 p=pathlib.Path(target);p.write_bytes((helpers/name).read_bytes());p.chmod(0o755)
sudo=pathlib.Path('/etc/sudoers.d/mysql-compare-deploy');sudo.write_bytes((helpers/'sudoers-mysql-compare-deploy').read_bytes());sudo.chmod(0o440);command(['visudo','-c','-f',str(sudo)])
ssh=STATE/'.ssh';ssh.mkdir(mode=0o700,exist_ok=True);os.chown(ssh,0,0)
auth=ssh/'authorized_keys';auth.write_text('restrict,command="/usr/local/libexec/mysql-compare-ssh-gateway" '+key+'\n');auth.chmod(0o600);os.chown(auth,0,0)
assert command(['systemctl','show','mysql-compare.service','-p','MainPID','--value']).strip()==before
print(json.dumps({'restricted_layout_installed':True,'runtime_PID_unchanged':True,'private_runtime_paths_denied':private,'only_sudo_restart':'mysql-compare.service','outer_link_root_owned':True,'sole_initial_release':old.name,'new_key_has_forced_command_and_restrict':True}))
