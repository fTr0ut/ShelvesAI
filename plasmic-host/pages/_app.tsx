import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PlasmicCanvasHost } from "@plasmicapp/loader-react";
import { PLASMIC } from "./plasmic-init";
import AppChrome from "./AppChrome"; // your normal layout/providers

function HostOnly() {
  // Absolutely no app chrome/auth/providers here
  return <PlasmicCanvasHost loader={PLASMIC} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/plasmic-host" element={<HostOnly />} />
        <Route path="/*" element={<AppChrome />} />
      </Routes>
    </BrowserRouter>
  );
}