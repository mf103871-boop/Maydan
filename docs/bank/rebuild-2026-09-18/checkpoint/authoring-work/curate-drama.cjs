const fs = require('fs');
const path = require('path');
const root = 'C:/Users/user/Desktop/maydan';
const targets = {200:.8,400:.6,600:.4,800:.25,1000:.15};
function writePack(id, rows, sources) {
  const file = path.join(root, 'src/data/categories', id+'.json');
  const pack = JSON.parse(fs.readFileSync(file,'utf8'));
  const count = {};
  pack.qs = rows.map(([p, topic, q, a, aliases, source]) => ({
    qid:`${id}-${p}-${900+(count[p]=(count[p]||0)+1)}`, p, topic, q, a,
    alt:aliases ? aliases.split('|') : [],
    sourceUrl:sources[source] || source,
    verified:true, difficultyTarget:targets[p]
  }));
  for (const p of Object.keys(targets)) if(count[p]!==8) throw new Error(id+' tier '+p+' count '+count[p]);
  fs.writeFileSync(file,JSON.stringify(pack,null,2)+'\n');
  console.log(id,pack.qs.length,'questions');
}
module.exports = {writePack};
