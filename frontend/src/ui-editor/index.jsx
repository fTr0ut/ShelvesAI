import { Navigate, Route, Routes } from 'react-router-dom'
import EditorLayout from './components/EditorLayout'
import EditorHome from './pages/EditorHome'
import RouteCoordinator from './pages/RouteCoordinator'
import ProjectSettings from './pages/ProjectSettings'

export default function UIEditorApp() {
  return (
    <Routes>
      <Route element={<EditorLayout />}>
        <Route index element={<EditorHome />} />
        <Route path="routes" element={<RouteCoordinator />} />
        <Route path="settings" element={<ProjectSettings />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Route>
    </Routes>
  )
}
