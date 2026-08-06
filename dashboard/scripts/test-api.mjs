const base = process.env.BLOCKLOGGER_URL?.replace(/\/api\/logs$/, "") || "http://127.0.0.1:8787";

async function main() {
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  if (!health.ok) throw new Error("health failed");

  const post = await fetch(`${base}/api/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      player: "TestBot",
      action: "placed",
      block: "minecraft:stone",
      location: { x: 1, y: 2, z: 3 },
      dimension: "minecraft:overworld",
      source: "test",
    }),
  });
  if (!post.ok) throw new Error(`POST failed ${post.status}`);

  const logs = await fetch(`${base}/api/logs?player=TestBot&limit=5`).then((r) =>
    r.json()
  );
  if (!logs.items?.length) throw new Error("lookup failed");

  const near = await fetch(`${base}/api/logs?x=1&y=2&z=3&radius=2`).then((r) =>
    r.json()
  );
  if (!near.items?.length) throw new Error("coord filter failed");

  console.log("OK: health, post, player filter, coord filter");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
