import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export async function assertAuthWebFixture(root, executablePath) {
  const {chromium}=createRequire(path.join(root,'apps/api/package.json'))('playwright-core');
  const dist=path.join(root,'apps/mobile/dist');
  const server=createServer((req,res)=>{
    const requested=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);
    const file=requested.startsWith(dist+path.sep)&&existsSync(requested)&&path.extname(requested)?requested:path.join(dist,'index.html');
    const mime={'.js':'application/javascript','.ttf':'font/ttf','.png':'image/png'};
    res.setHeader('content-type',mime[path.extname(file)]??'text/html');res.end(readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage();let requested=false,unexpected=false;
    await page.route('**/api/**',route=>{
      if(route.request().url()==='http://127.0.0.1:3001/api/auth/methods')requested=true;else unexpected=true;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({passwordLogin:true,passwordRegistration:false,codeLogin:{email:'CONFIGURED',phone:'UNAVAILABLE'}})});
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/auth/login');
    await page.getByRole('textbox',{name:'邮箱',exact:true}).waitFor({timeout:10000});
    await page.getByRole('button',{name:'获取验证码',exact:true}).waitFor({timeout:10000});
    if(!requested||unexpected)throw new Error('Wrong exported fixture target');
  } catch {const error=new Error('Build the Web fixture explicitly for development and localhost API before isolated browser tests');error.code='AUTH_EXPORTED_WEB_FIXTURE_INVALID';throw error;}
  finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
