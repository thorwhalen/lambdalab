/** Routes and the persistent chrome. */
import { NavLink, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { About } from './pages/About';
import { LessonRoute } from './pages/LessonRoute';
import { NotFound } from './pages/NotFound';

function Header() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm transition ${
      isActive ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-100'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
        <NavLink to="/" className="flex items-center gap-2.5">
          <span className="math text-2xl leading-none text-lam-400">λ</span>
          <span className="text-lg font-semibold tracking-tight text-ink-100">LambdaLab</span>
        </NavLink>
        <nav className="ml-auto flex items-center gap-1">
          <NavLink to="/" className={link} end>
            Course
          </NavLink>
          <NavLink to="/about" className={link}>
            About
          </NavLink>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-ink-800/80 py-8">
      <div className="mx-auto max-w-6xl px-5 text-sm text-ink-600">
        <p>
          LambdaLab — the theory of computation, for curious minds. Built for two kids who asked
          too many questions.
        </p>
        <p className="mt-1">
          Everything here is free. Your progress lives in your browser; there are no accounts.
        </p>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div className="grid-paper min-h-full">
      <Header />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/lesson/:id" element={<LessonRoute />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
