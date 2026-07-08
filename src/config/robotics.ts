// Curated registry of major robotics organizations (humanoid, industrial,
// quadruped, research). Reference data — public HQ/site locations and focus.
// Powers the Robotics map layer and enriches the Robotics lens.

export type RoboticsCategory =
  | 'humanoid'
  | 'industrial'
  | 'quadruped'
  | 'platform'   // chips / simulation / foundation models for robots
  | 'research';

export interface RoboticsOrg {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  city: string;
  category: RoboticsCategory;
  focus: string;
  url?: string;
}

export const ROBOTICS_ORGS: RoboticsOrg[] = [
  { id: 'boston-dynamics', name: 'Boston Dynamics', lat: 42.3760, lon: -71.2350, country: 'USA', city: 'Waltham, MA', category: 'humanoid', focus: 'Atlas (electric humanoid), Spot quadruped', url: 'https://bostondynamics.com' },
  { id: 'figure', name: 'Figure AI', lat: 37.3688, lon: -122.0363, country: 'USA', city: 'Sunnyvale, CA', category: 'humanoid', focus: 'Figure 02/03 general-purpose humanoid', url: 'https://figure.ai' },
  { id: 'tesla-optimus', name: 'Tesla (Optimus)', lat: 30.2226, lon: -97.6175, country: 'USA', city: 'Austin, TX', category: 'humanoid', focus: 'Optimus mass-market humanoid', url: 'https://tesla.com' },
  { id: 'unitree', name: 'Unitree Robotics', lat: 30.2741, lon: 120.1551, country: 'China', city: 'Hangzhou', category: 'quadruped', focus: 'G1/H1 humanoids, Go2 quadruped', url: 'https://unitree.com' },
  { id: 'agility', name: 'Agility Robotics', lat: 44.9429, lon: -123.0351, country: 'USA', city: 'Salem, OR', category: 'humanoid', focus: 'Digit warehouse humanoid (RoboFab)', url: 'https://agilityrobotics.com' },
  { id: '1x', name: '1X Technologies', lat: 59.4340, lon: 10.6577, country: 'Norway', city: 'Moss', category: 'humanoid', focus: 'NEO home humanoid', url: 'https://1x.tech' },
  { id: 'apptronik', name: 'Apptronik', lat: 30.2672, lon: -97.7431, country: 'USA', city: 'Austin, TX', category: 'humanoid', focus: 'Apollo industrial humanoid', url: 'https://apptronik.com' },
  { id: 'sanctuary', name: 'Sanctuary AI', lat: 49.2827, lon: -123.1207, country: 'Canada', city: 'Vancouver', category: 'humanoid', focus: 'Phoenix dexterous humanoid', url: 'https://sanctuary.ai' },
  { id: 'anybotics', name: 'ANYbotics', lat: 47.3769, lon: 8.5417, country: 'Switzerland', city: 'Zurich', category: 'quadruped', focus: 'ANYmal industrial inspection quadruped', url: 'https://anybotics.com' },
  { id: 'fourier', name: 'Fourier Intelligence', lat: 31.2304, lon: 121.4737, country: 'China', city: 'Shanghai', category: 'humanoid', focus: 'GR-1/GR-2 humanoids, rehab robotics', url: 'https://fourierintelligence.com' },
  { id: 'ubtech', name: 'UBTech Robotics', lat: 22.5431, lon: 114.0579, country: 'China', city: 'Shenzhen', category: 'humanoid', focus: 'Walker S industrial humanoid', url: 'https://ubtrobot.com' },
  { id: 'physical-intelligence', name: 'Physical Intelligence', lat: 37.7749, lon: -122.4194, country: 'USA', city: 'San Francisco, CA', category: 'platform', focus: 'π (pi) foundation models for robots', url: 'https://physicalintelligence.company' },
  { id: 'skild', name: 'Skild AI', lat: 40.4406, lon: -79.9959, country: 'USA', city: 'Pittsburgh, PA', category: 'platform', focus: 'General-purpose robot brain / foundation model' },
  { id: 'nvidia-isaac', name: 'NVIDIA (Isaac / GR00T)', lat: 37.3541, lon: -121.9552, country: 'USA', city: 'Santa Clara, CA', category: 'platform', focus: 'Isaac sim, GR00T humanoid foundation model', url: 'https://nvidia.com/isaac' },
  { id: 'fanuc', name: 'FANUC', lat: 35.4894, lon: 138.7986, country: 'Japan', city: 'Oshino', category: 'industrial', focus: 'Industrial arms & factory automation', url: 'https://fanuc.co.jp' },
  { id: 'kuka', name: 'KUKA', lat: 48.3705, lon: 10.8978, country: 'Germany', city: 'Augsburg', category: 'industrial', focus: 'Industrial robot arms & automation', url: 'https://kuka.com' },
  { id: 'abb-robotics', name: 'ABB Robotics', lat: 59.6099, lon: 16.5448, country: 'Sweden', city: 'Västerås', category: 'industrial', focus: 'Industrial & collaborative robotics', url: 'https://abb.com/robotics' },
];

export function roboticsCategoryColor(category: RoboticsCategory): [number, number, number, number] {
  switch (category) {
    case 'humanoid': return [120, 200, 255, 210];
    case 'quadruped': return [130, 240, 180, 210];
    case 'industrial': return [255, 180, 90, 200];
    case 'platform': return [200, 140, 255, 210];
    default: return [180, 190, 200, 190];
  }
}
