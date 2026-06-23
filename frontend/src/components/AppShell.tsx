import { Outlet } from "react-router-dom";

import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppShell() {
  return (
    <div className="flex min-h-screen bg-app">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar />
        <main id="main-content" className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
