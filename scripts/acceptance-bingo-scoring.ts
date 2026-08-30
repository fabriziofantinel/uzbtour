import assert from "node:assert/strict";
import { bingoMilestone, bingoScore } from "../lib/bingo-scoring";

const ids=Array.from({length:15},(_,index)=>`cell-${index+1}`);
assert.equal(bingoMilestone(1),null);
assert.deepEqual(bingoMilestone(2),{label:"Ambo",points:5});
assert.deepEqual(bingoMilestone(3),{label:"Terno",points:10});
assert.deepEqual(bingoMilestone(4),{label:"Quaterna",points:20});
assert.deepEqual(bingoMilestone(5),{label:"Cinquina",points:30});
assert.equal(bingoScore(ids.slice(0,2),ids),5);
assert.equal(bingoScore(ids.slice(0,3),ids),10);
assert.equal(bingoScore(ids.slice(0,4),ids),20);
assert.equal(bingoScore(ids.slice(0,5),ids),30);
assert.equal(bingoScore([...ids.slice(0,5),...ids.slice(5,8)],ids),40);
assert.equal(bingoScore(ids,ids),140);
assert.equal(bingoScore([ids[0],ids[5],ids[10]],ids),0);
console.log(JSON.stringify({status:"passed",milestones:{ambo:5,terno:10,quaterna:20,cinquina:30,tombolaBonus:50,maximum:140}}));
