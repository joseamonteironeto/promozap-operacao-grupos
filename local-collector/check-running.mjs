try {
  const response = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(2000) });
  const result = await response.json();
  if (!response.ok || !result.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}

