import { loadInitialData } from './data/fetcher';
import { MapRenderer } from './map/Renderer';

async function bootstrap() {
  const orientationGuide = document.getElementById('orientation-guide');
  
  function checkOrientation() {
    if (window.innerHeight > window.innerWidth) {
      orientationGuide?.classList.remove('hidden');
    } else {
      orientationGuide?.classList.add('hidden');
    }
  }
  
  window.addEventListener('resize', checkOrientation);
  checkOrientation();

  try {
    const data = await loadInitialData();
    const renderer = new MapRenderer('map-container');
    renderer.setData(data);
    await renderer.renderBaseMap();
  } catch (error) {
    console.error('初始化失败:', error);
  }
}

bootstrap();
