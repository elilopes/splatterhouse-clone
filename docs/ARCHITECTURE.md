# Architecture decisions

- Babylon.js is the 3D runtime; React is the application shell and HUD.
- Web and Android share the same frontend bundle through Capacitor.
- Local guest saves are the offline-first baseline.
- Firebase Auth supports anonymous and Google identity. Firestore stores per-user progress.
- The Fastify API is reserved for server-validated results, leaderboard aggregation and future anti-cheat checks.
- Firebase client configuration is public application configuration. Admin credentials remain server-side only.
- Assets are loaded from owned or licensed GLB/audio/texture packages.
