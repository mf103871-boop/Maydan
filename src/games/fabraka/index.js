import meta from './meta.js';
import { Game, SetupOptions } from './Game.jsx';
import { FabrakaIcon } from './icon.jsx';
import { SAVE_KEY } from './logic.js';

// activeKeys: شاشة التعطّل تمسح الجلسة الجارية أولًا وتبقي النتائج المحفوظة والخيارات.
export default { ...meta, icon: FabrakaIcon, Component: Game, SetupOptions, activeKeys: [SAVE_KEY] };
