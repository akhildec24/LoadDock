import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import Tests from "./pages/Tests";
import Runs from "./pages/Runs";
import Compare from "./pages/Compare";
import Runners from "./pages/Runners";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<Projects />} />
          <Route path="/tests" element={<Tests />} />
          <Route path="/tests/:testId" element={<Tests />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:runId" element={<Runs />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/runners" element={<Runners />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
