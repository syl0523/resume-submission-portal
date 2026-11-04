import { createBrowserRouter, RouterProvider } from 'react-router';
import { Shell } from './components/Shell';
import { AddJob } from './pages/AddJob';
import { ApplicationDetailPage } from './pages/ApplicationDetail';
import { Applications } from './pages/Applications';
import { Boards } from './pages/Boards';
import { Dashboard } from './pages/Dashboard';
import { Discover } from './pages/Discover';
import { Imports } from './pages/Imports';
import { InboxPage } from './pages/Inbox';
import { JobMatch, SearchDetail } from './pages/JobMatch';
import { NotFound } from './pages/NotFound';
import { Resumes } from './pages/Resumes';
import { SettingsPage } from './pages/Settings';

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/applications', element: <Applications /> },
      { path: '/applications/new', element: <AddJob /> },
      { path: '/applications/:id', element: <ApplicationDetailPage /> },
      { path: '/match', element: <JobMatch /> },
      { path: '/match/:id', element: <SearchDetail /> },
      { path: '/discover', element: <Discover /> },
      { path: '/boards', element: <Boards /> },
      { path: '/inbox', element: <InboxPage /> },
      { path: '/resumes', element: <Resumes /> },
      { path: '/imports', element: <Imports /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
