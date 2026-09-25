// STUB — owned by the SKY-FX agent. Contract: createPost(ctx) -> { render(frame), setSize(w, h) }
export function createPost(ctx) {
  return {
    render(frame) {
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
    setSize() {},
  };
}
