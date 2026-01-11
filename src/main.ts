import './styles/main.css';
import { inject } from '@vercel/analytics';
import { App } from './App';

// Initialize Vercel Analytics
inject();

const app = new App('app');
app.init().catch(console.error);
