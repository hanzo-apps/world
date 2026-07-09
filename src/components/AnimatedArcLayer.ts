import { ArcLayer, type ArcLayerProps } from '@deck.gl/layers';
import type { DefaultProps } from '@deck.gl/core';
import type { ShaderModule } from '@luma.gl/shadertools';

// A subtle white pulse that travels source→target along each arc. Extends the
// stock deck.gl ArcLayer (v9 UBO uniforms) with one extra float, `coef`, a
// 0→1 head position advanced on requestAnimationFrame by DeckGLMap. The pulse is
// pure alpha modulation over the arc's own (monochrome) colour — no rainbow, no
// second draw pass — so a heavier arc still reads brighter and the whole thing
// stays strictly within the vercel-black design canon.

type AnimatedArcUniforms = { coef: number };

// Matches the injected fragment reference `animatedArc.coef`. Order + type MUST
// match the uniform block declaration (luma v9 packs these into a UBO).
const uniformBlock = /* glsl */ `\
uniform animatedArcUniforms {
  float coef;
} animatedArc;
`;

const animatedArcModule: ShaderModule<AnimatedArcUniforms> = {
  name: 'animatedArc',
  fs: uniformBlock,
  uniformTypes: { coef: 'f32' },
};

export type AnimatedArcLayerProps<DataT = unknown> = ArcLayerProps<DataT> & {
  /** Head position of the travelling pulse, in [0, 1). */
  coef?: number;
};

const defaultProps: DefaultProps<AnimatedArcLayerProps> = {
  coef: { type: 'number', value: 0 },
};

export class AnimatedArcLayer<DataT = unknown> extends ArcLayer<DataT, { coef?: number }> {
  static layerName = 'AnimatedArcLayer';
  static defaultProps = defaultProps as unknown as DefaultProps;

  getShaders() {
    const shaders = super.getShaders();
    shaders.modules = [...shaders.modules, animatedArcModule];
    shaders.inject = {
      ...(shaders.inject ?? {}),
      // uv.x is the segment ratio (0 at source → 1 at target). `behind` measures
      // how far a fragment sits behind the moving head; exp() gives a short comet
      // tail. A 0.4 floor keeps the arc always visible; the pulse brightens to 1.
      'fs:DECKGL_FILTER_COLOR': /* glsl */ `
        float arcRatio = geometry.uv.x;
        float behind = fract(animatedArc.coef - arcRatio);
        float pulse = exp(-behind * 6.0);
        color.a *= mix(0.40, 1.0, pulse);
      `,
    };
    return shaders;
  }

  draw(params: { uniforms: Record<string, unknown> }): void {
    this.state.model?.shaderInputs.setProps({ animatedArc: { coef: this.props.coef ?? 0 } });
    super.draw(params);
  }
}
