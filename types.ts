
export enum AppState {
  IDLE = 'IDLE',
  MATCHING = 'MATCHING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface Persona {
  name: string;
  instruction: string;
  voice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
}
