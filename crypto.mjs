import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function encrypt(data,key){
  const nonce=randomBytes(12), c=createCipheriv('aes-256-gcm',key,nonce);
  const encrypted=Buffer.concat([c.update(data),c.final()]);
  return Buffer.concat([Buffer.from('HFB1'),nonce,c.getAuthTag(),encrypted]);
}
export function decrypt(data,key){
  if(data.subarray(0,4).toString()!=='HFB1')throw Error('Invalid encrypted archive');
  const d=createDecipheriv('aes-256-gcm',key,data.subarray(4,16));
  d.setAuthTag(data.subarray(16,32));
  return Buffer.concat([d.update(data.subarray(32)),d.final()]);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const [mode,input,output,keyFile]=process.argv.slice(2);
  const key=Buffer.from(keyFile?readFileSync(keyFile,'utf8').trim():process.env.RENDER_KEY,'base64');
  if(key.length!==32)throw Error('Expected 256-bit key');
  writeFileSync(output,(mode==='encrypt'?encrypt:decrypt)(readFileSync(input),key),{mode:0o600});
}
