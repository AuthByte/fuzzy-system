import { insertLogs } from "../db.mjs";

const now = Date.now();
const sample = [
  {
    time: new Date(now - 90_000).toISOString(),
    player: "Finn",
    action: "placed",
    block: "minecraft:diamond_block",
    location: { x: 152, y: 67, z: -421 },
    dimension: "minecraft:overworld",
    source: "seed",
  },
  {
    time: new Date(now - 60_000).toISOString(),
    player: "Steve",
    action: "broken",
    block: "minecraft:chest",
    location: { x: 150, y: 66, z: -419 },
    dimension: "minecraft:overworld",
    source: "seed",
  },
  {
    time: new Date(now - 30_000).toISOString(),
    player: "Finn",
    action: "broken",
    block: "minecraft:diamond_ore",
    location: { x: 124, y: 11, z: -392 },
    dimension: "minecraft:overworld",
    source: "seed",
  },
  {
    time: new Date(now - 15_000).toISOString(),
    player: "Alex",
    action: "placed",
    block: "minecraft:obsidian",
    location: { x: 0, y: 64, z: 0 },
    dimension: "minecraft:nether",
    source: "seed",
  },
];

const inserted = insertLogs(sample);
console.log(`Seeded ${inserted.length} sample events.`);
