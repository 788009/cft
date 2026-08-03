import { describe, it, expect } from 'vitest';
import { LevelManager } from '../LevelManager';

describe('Level Manager', () => {
  it('should initialize with province level', () => {
    const manager = new LevelManager();
    expect(manager.getLevel()).toBe('province');
  });

  it('should switch to city level only when exceeding hysteresis in threshold', () => {
    const manager = new LevelManager();
    manager.update(2.6);
    expect(manager.getLevel()).toBe('province'); 
    
    manager.update(2.7);
    expect(manager.getLevel()).toBe('city');
  });

  it('should remain at city level until dropping below hysteresis out threshold', () => {
    const manager = new LevelManager();
    manager.update(3.0); 
    expect(manager.getLevel()).toBe('city');

    manager.update(2.4); 
    expect(manager.getLevel()).toBe('city');

    manager.update(2.2); 
    expect(manager.getLevel()).toBe('province');
  });

  it('should switch between city and district levels with hysteresis', () => {
    const manager = new LevelManager();
    manager.update(4.0); 
    expect(manager.getLevel()).toBe('city');

    manager.update(6.2);
    expect(manager.getLevel()).toBe('city');

    manager.update(6.3);
    expect(manager.getLevel()).toBe('district');

    manager.update(5.8);
    expect(manager.getLevel()).toBe('district');

    manager.update(5.6);
    expect(manager.getLevel()).toBe('city');
  });

  it('should jump directly to the district level at a high initial zoom', () => {
    const manager = new LevelManager();
    expect(manager.update(7)).toBe('district');
    expect(manager.update(2)).toBe('province');
  });

  it('should remain at the finest available level', () => {
    const manager = new LevelManager();
    manager.setAvailability({ district: false });
    expect(manager.update(7)).toBe('city');

    manager.setAvailability({ city: false });
    expect(manager.update(7)).toBe('province');
  });
});
