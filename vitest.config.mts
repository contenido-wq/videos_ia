import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      // Worktrees viven como subcarpetas del repo (superpowers:using-git-worktrees
      // y el EnterWorktree nativo) — sin esto, vitest corrido desde la raíz
      // barre recursivamente y suma los tests de CUALQUIER worktree activo,
      // propio o ajeno, inflando/contaminando el resultado.
      "**/.worktrees/**",
      "**/.claude/worktrees/**",
    ],
  },
});
