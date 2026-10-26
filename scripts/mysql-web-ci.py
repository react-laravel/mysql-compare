#!/usr/bin/env python3
"""Small hosted-CI selector/client. Never receives website credentials."""
import argparse,json,os,pathlib,re,subprocess,sys,tempfile
REPO='react-laravel/mysql-compare'
SHA=re.compile(r'[0-9a-f]{40}\Z')
def need(ok,message):
 if not ok:raise RuntimeError(message)
def run(args,**kw):
 r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False,**kw);need(r.returncode==0,'CI command failed; private output suppressed');return r.stdout
def api(path):return json.loads(run(['gh','api',path]))
def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True);sub.add_parser('select');d=sub.add_parser('deploy');d.add_argument('--revision',required=True);d.add_argument('--archive',required=True);d.add_argument('--check-only',action='store_true');a=p.parse_args()
 if a.command=='select':
  need(os.environ.get('GITHUB_REPOSITORY')==REPO,'Unexpected repository')
  event=os.environ.get('GITHUB_EVENT_NAME');requested=os.environ.get('REQUESTED_SOURCE_REVISION','')
  if event=='push':
   need(os.environ.get('GITHUB_REF')=='refs/heads/electron','Only website-branch pushes can publish')
   sha=os.environ.get('GITHUB_SHA','');need(SHA.fullmatch(sha),'Invalid workflow revision')
   need(api('repos/'+REPO+'/git/ref/heads/electron')['object']['sha']==sha,'Stale automatic publication refused')
  else:need(event=='workflow_dispatch','Unexpected event');sha=requested;need(SHA.fullmatch(sha),'Choose the exact website source revision')
  need(api('repos/'+REPO+'/commits/'+sha)['sha']==sha,'Source commit missing')
  output=os.environ.get('GITHUB_OUTPUT');need(output,'CI output channel is missing')
  with open(output,'a') as f:f.write('source_revision='+sha+'\n')
  print(json.dumps({'source_revision':sha,'website_edition':'electron'}));return
 need(SHA.fullmatch(a.revision),'Invalid runtime revision');archive=pathlib.Path(a.archive)
 if not a.check_only:need(archive.is_file() and archive.stat().st_size<=32*1024*1024,'Invalid upload archive')
 key=os.environ.get('B_MYSQL_COMPARE_DEPLOY_SSH_KEY','');hosts=os.environ.get('B_MYSQL_COMPARE_DEPLOY_KNOWN_HOSTS','');need(key and hosts,'Dedicated B deployment secrets are missing')
 with tempfile.TemporaryDirectory(prefix='mysql-b-deploy-') as temp:
  os.chmod(temp,0o700);root=pathlib.Path(temp);kp=root/'key';hp=root/'known_hosts';kp.write_text(key.rstrip()+'\n');hp.write_text(hosts.rstrip()+'\n');kp.chmod(0o600);hp.chmod(0o600)
  ssh=['ssh','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(hp),'-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-i',str(kp),'mysql-compare-deploy@154.21.197.138']
  if a.check_only:run(ssh+['validate '+a.revision],timeout=120)
  else:
   with archive.open('rb') as f:run(ssh+['receive '+a.revision],stdin=f,timeout=180)
   run(ssh+['publish '+a.revision],timeout=240)
 print(json.dumps({'validation_only':a.check_only,'runtime_revision':a.revision,'private_key_file_removed':True,'website_credentials_read':False}))
if __name__=='__main__':
 try:main()
 except BaseException:
  print('Hosted MySQL website operation failed; inspect non-secret CI steps and protected B logs.',file=sys.stderr);sys.exit(1)
