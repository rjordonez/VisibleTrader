
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A circular import chain is a sign two modules should be merged or a shared dependency extracted.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'A module nothing imports is dead code — this is exactly the check that would have caught ' +
        'src/App.css and src/landing/components/ProfitModal.tsx sitting around unused before this cleanup.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)src/main\\.tsx$', // the actual entry point, loaded by index.html, not by an import
          '\\.d\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'no-landing-importing-app',
      severity: 'error',
      comment: 'src/landing (marketing/pricing/signup pages) and src/app (the authenticated product) are ' +
        'separate concerns — the landing pages must never reach into product internals.',
      from: { path: '^src/landing/' },
      to: { path: '^src/app/' },
    },
    {
      name: 'no-app-importing-landing',
      severity: 'error',
      comment: 'Same boundary, the other direction — the product must not depend on marketing-page internals.',
      from: { path: '^src/app/' },
      to: { path: '^src/landing/' },
    },
    {
      name: 'lib-is-a-leaf',
      severity: 'error',
      comment: 'src/lib (the Supabase client) is shared by both app/ and landing/ — it must stay a dependency-' +
        'free leaf so both can safely depend on it without pulling in the other.',
      from: { path: '^src/lib/' },
      to: { path: '^src/(app|landing)/' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.app.json' },
    exclude: { path: 'node_modules' },
    doNotFollow: { path: 'node_modules' },
  },
}
