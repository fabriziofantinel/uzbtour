import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const immutableMigrationMax=55;
const expected={
  database:{count:41,digest:"e231baaaa8d38c7bbb46d3feef9dc413c011229f5e1688b664b354db4793fc86"},
  layout:{count:46,digest:"d0deb89d4ddbcfc9eeaae11eac358de7d0c158c09db6508e7ebf9c2285ff22d0"},
};

async function filesBelow(directory,predicate){
  const result=[];
  async function visit(current){
    for(const entry of await readdir(current,{withFileTypes:true})){
      const absolute=resolve(current,entry.name);
      if(entry.isDirectory())await visit(absolute);
      else if(predicate(absolute))result.push(absolute);
    }
  }
  await visit(directory);
  return result;
}

async function fingerprint(files){
  const entries=[];
  for(const absolute of files.sort()){
    const path=relative(root,absolute).replaceAll("\\","/");
    const normalized=(await readFile(absolute,"utf8")).replaceAll("\r\n","\n");
    const hash=createHash("sha256").update(normalized).digest("hex");
    entries.push({path,hash});
  }
  const digest=createHash("sha256")
    .update(entries.map(entry=>`${entry.path}\0${entry.hash}\n`).join(""))
    .digest("hex");
  return {count:entries.length,digest,files:entries.map(entry=>entry.path)};
}

const migrations=await filesBelow(resolve(root,"database/migrations"),absolute=>{
  const match=absolute.replaceAll("\\","/").match(/\/(\d{3})_[^/]+\.sql$/);
  return Boolean(match&&Number(match[1])<=immutableMigrationMax);
});
const appFiles=await filesBelow(resolve(root,"app"),absolute=>{
  const path=relative(root,absolute).replaceAll("\\","/");
  return !path.startsWith("app/api/")&&(path.endsWith(".tsx")||path.endsWith(".css"));
});
const database=await fingerprint(migrations);
const layout=await fingerprint([resolve(root,"DESIGN.md"),resolve(root,"PRODUCT.md"),...appFiles]);
const report={immutableMigrationMax,database,layout};

if(process.argv.includes("--report")){
  console.log(JSON.stringify(report,null,2));
  process.exit(0);
}

const failures=[];
for(const area of ["database","layout"]){
  if(report[area].count!==expected[area].count||report[area].digest!==expected[area].digest){
    failures.push(`${area}: baseline modificata (atteso ${expected[area].count}/${expected[area].digest}, rilevato ${report[area].count}/${report[area].digest})`);
  }
}
if(failures.length)throw new Error(`${failures.join("\n")}\nEseguire npm run quality:baseline:report e aggiornare la baseline solo dopo approvazione esplicita.`);
console.log(JSON.stringify({status:"passed",database:expected.database,layout:expected.layout}));
