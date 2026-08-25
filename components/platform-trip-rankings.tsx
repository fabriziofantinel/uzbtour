"use client";

import { Brain, Camera, Compass, Crown, Gamepad2, Grid3X3, Medal, Trophy } from "lucide-react";
import type { TravelerExperience as Experience } from "@/lib/platform/traveler-experience";

type Category = "quiz" | "missioni" | "bingo" | "giochi" | "foto";

function bingoMilestoneScore(completed: number) {
  if (completed >= 5) return 30;
  if (completed === 4) return 20;
  if (completed === 3) return 10;
  if (completed === 2) return 5;
  return 0;
}

function bingoScore(contentIds: Set<string>, bingoIds: string[]) {
  const rows = [bingoIds.slice(0, 5), bingoIds.slice(5, 10), bingoIds.slice(10, 15)];
  const rowScore = rows.reduce((sum, row) => sum + bingoMilestoneScore(row.filter((id) => contentIds.has(id)).length), 0);
  return rowScore + (bingoIds.length === 15 && bingoIds.every((id) => contentIds.has(id)) ? 50 : 0);
}

export default function PlatformTripRankings({ experience, userName }: { experience: Experience; userName: string }) {
  const names = experience.journey.travelers.map((traveler) => traveler.name);
  const bingoIds = experience.challenges.filter((challenge) => challenge.type === "bingo_item").slice(0, 15).map((challenge) => challenge.id);
  const totals = new Map(names.map((name) => [name, { quiz: 0, missioni: 0, bingo: 0, giochi: 0, foto: 0 }]));

  for (const name of names) {
    const traveler = totals.get(name)!;
    const approved = experience.challengeResults.filter((result) => result.travelerName === name && result.status === "approved");
    traveler.quiz = approved.filter((result) => result.type === "quiz").reduce((sum, result) => sum + result.score, 0);
    traveler.missioni = approved.filter((result) => result.type === "mission").reduce((sum, result) => sum + result.score, 0);
    traveler.giochi = approved.filter((result) => result.type === "game").reduce((sum, result) => sum + result.score, 0);
    traveler.bingo = bingoScore(new Set(approved.filter((result) => result.type === "bingo").map((result) => result.contentId)), bingoIds);
    traveler.foto = experience.contestEntries.filter((entry) => entry.travelerName === name)
      .reduce((sum, entry) => sum + (entry.score ?? (entry.isWinner ? 20 : 0)), 0);
  }

  const categories: Array<{ key: Category; label: string; Icon: typeof Trophy }> = [
    { key: "quiz", label: "Quiz", Icon: Brain },
    { key: "missioni", label: "Missioni", Icon: Compass },
    { key: "bingo", label: "Bingo", Icon: Grid3X3 },
    { key: "giochi", label: "Giochi", Icon: Gamepad2 },
    { key: "foto", label: "Contest foto", Icon: Camera },
  ];
  const general = [...totals].map(([name, scores]) => ({
    name, score: Object.values(scores).reduce((sum, value) => sum + value, 0),
  })).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  return <section className="rankingsPage">
    <header className="rankingsHero"><div><span>CLASSIFICHE DELLA FAMIGLIA</span><h2>Chi guida il viaggio?</h2><p>Quiz, missioni, bingo, giochi e contest fotografici confluiscono nella classifica generale.</p></div><Trophy/></header>
    <section className="generalRanking"><div className="rankingTitle"><Medal/><div><small>CLASSIFICA GENERALE</small><h3>{experience.journey.partyName}</h3></div></div><div className="rankingRows">{general.map((entry, index) => <article className={entry.name === userName ? "current" : ""} key={entry.name}><span>{index === 0 ? <Crown/> : index + 1}</span><i>{entry.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</i><strong>{entry.name}</strong><b>{entry.score} pt</b></article>)}</div></section>
    <div className="categoryRankings">{categories.map(({ key, label, Icon }) => {
      const ranking = [...totals].map(([name, scores]) => ({ name, score: scores[key] })).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
      return <section key={key}><header><span><Icon/></span><div><small>CLASSIFICA</small><h3>{label}</h3></div></header>{ranking.map((entry, index) => <article className={entry.name === userName ? "current" : ""} key={entry.name}><span>{index + 1}</span><strong>{entry.name}</strong><b>{entry.score} pt</b></article>)}</section>;
    })}</div>
    <p className="rankingRules">Bingo: ambo 5 pt, terno 10 pt, quaterna 20 pt, cinquina 30 pt per riga; tombola 50 pt aggiuntivi. Missioni e foto-prova entrano in classifica dopo la validazione.</p>
  </section>;
}
