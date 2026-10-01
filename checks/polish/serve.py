from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json,os
root=Path(__file__).resolve().parents[2]
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw): super().__init__(*a,directory=str(root/'dist'),**kw)
 def do_GET(self):
  if self.path.split('?')[0] in ['/benchmark.html','/safari-check.html']:
   data=(root/'checks/polish'/self.path.split('?')[0].lstrip('/')).read_bytes();self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(data)
  else: super().do_GET()
 def do_POST(self):
  name=self.path.removeprefix('/result/')
  if '/' in name or not name.endswith('.json'):self.send_error(400);return
  data=self.rfile.read(int(self.headers['Content-Length']));json.loads(data)
  (root/'checks/polish'/name).write_bytes(data);self.send_response(200);self.end_headers();self.wfile.write(b'ok')
 def log_message(self,*a):pass
ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('PORT','4185'))),Handler).serve_forever()
