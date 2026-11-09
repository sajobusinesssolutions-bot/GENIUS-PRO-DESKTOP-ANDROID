import { registerRootComponent } from 'expo';
// before anything calls the server: api.saljoe.tech first, api.saljoetech.tech as the backup
import { installServerFailover } from './src/data/serverFailover';
installServerFailover();

import App from './App';
// the background check is defined at the top level, before anything runs (notify.ts)
import './src/data/notify';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
