import { defineConfig } from 'vite';

export default defineConfig({
    base: '/spell-the-rpg/',

    build: {
        rolldownOptions: {
            // Two pages: the character sheet and the shared map
            input: {
                main: 'index.html',
                map: 'map.html'
            }
        }
    }
});
