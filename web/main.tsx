import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import './styles.css';
import { App } from './App';
createRoot(document.getElementById('root')!).render(
  <Theme appearance="dark" accentColor="jade" grayColor="sage" radius="medium" scaling="100%">
    <App />
  </Theme>,
);
