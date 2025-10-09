import { Navigate, Route, Routes } from 'react-router-dom'
import EditorLayout from './components/EditorLayout'
import EditorOverview from './pages/EditorOverview'
import CanvasWorkspace from './pages/CanvasWorkspace'
import RouteCoordinator from './pages/RouteCoordinator'
import ProjectSettings from './pages/ProjectSettings'

export default function UIEditorApp() {
  return (
    <Routes>
      <Route element={<EditorLayout />}>
        <Route index element={<EditorOverview />} />
        <Route path="canvas" element={<CanvasWorkspace />} />
        <Route path="routes" element={<RouteCoordinator />} />
        <Route path="settings" element={<ProjectSettings />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Route>
    </Routes>
  )
}
