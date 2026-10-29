import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DECIDER_ID,DECIDER_HASHES} from '../../extension/decider-manifest.mjs';
for(const [file,hash] of Object.entries(DECIDER_HASHES)){
 const stream=fs.createReadStream(process.argv[2]+'/'+file),h=createHash('sha256');
 for await(const chunk of stream)h.update(chunk);
 if(h.digest('hex')!==hash)throw Error('Artifact mismatch: '+file);
}
fs.writeFileSync(process.argv[3],JSON.stringify(DECIDER_HASHES));
console.log('Verified '+DECIDER_ID);
