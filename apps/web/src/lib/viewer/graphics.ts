export type Resolution = 'auto' | 1 | 0.85 | 0.7 | 0.5;

export interface GraphicsSettings {
	resolution: Resolution;
	msaa: 0 | 2 | 4;
}

export interface DebugToggles {
	world: boolean;
	models: boolean;
	ghosts: boolean;
	viewmodel: boolean;
	effects: boolean;
	bloom: boolean;
	overlay: boolean;
	prepass: boolean;
	compactColor: boolean;
}

export const defaultDebug: DebugToggles = {
	world: true,
	models: true,
	ghosts: true,
	viewmodel: true,
	effects: true,
	bloom: true,
	overlay: true,
	prepass: false,
	compactColor: false
};

export const defaultGraphics: GraphicsSettings = { resolution: 'auto', msaa: 4 };
