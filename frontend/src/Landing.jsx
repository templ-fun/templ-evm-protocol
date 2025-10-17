import "./Landing.css";

export default function Landing({ onEnterApp } = {}) {
  const handleEnter = () => {
    if (typeof onEnterApp === 'function') {
      onEnterApp();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign('/create');
    }
  };

  return (
    <main className="landing">
      <iframe width="100%" height="800" src="https://embed.figma.com/proto/YN1LcJpWDTS5zwwx044xN2/TEMPL.FUN?page-id=0%3A1&node-id=1767-43677&starting-point-node-id=1563%3A14942&embed-host=templ.fun&footer=false&device-frame=false&viewport-controls=false&hotspot-hints=false&scaling=contain&content-scaling=responsive"></iframe>
      <div className="landing-actions">
        <button type="button" className="landing-cta" onClick={handleEnter}>
          Launch Templ Mini App
        </button>
      </div>
    </main>
  );
}
