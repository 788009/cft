import { AppController } from '@/AppController';
import { defaultConfig } from '@/config';

document.title = defaultConfig.pageTitle;
const app = new AppController();
app.start();
