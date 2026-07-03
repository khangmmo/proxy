import { Router } from "express";

const router = Router();

const UPSTREAM = "http://113.188.150.144:5555";
const TIMEOUT_MS = 10_000;

async function upstream(path: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${UPSTREAM}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();
    return { ok: true, data, status: res.status };
  } catch (err) {
    return { ok: false, data: { error: String(err) }, status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

router.post("/proxy/check_key", async (req, res) => {
  const { key } = req.body as { key?: string };
  const result = await upstream("/check_key", { key });
  res.status(result.status).json(result.data);
});

router.post("/proxy/rotate", async (req, res) => {
  const { key } = req.body as { key?: string };
  const result = await upstream("/rotate", { key });
  res.status(result.status).json(result.data);
});

export default router;
