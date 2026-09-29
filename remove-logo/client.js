window.__ModuleLoader__.load({
  id: '@local/remove-logo',
  factory() {
    const Empty = () => null;
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
          name: 'sidebar.brand.mark', id: 'remove-logo-mark', priority: -100,
        }, Empty));
        ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
          name: 'sidebar.brand.name', id: 'remove-logo-name', priority: -100,
        }, Empty));
      },
    };
  },
});
