import "./Landing.css";

export default function Landing() {
  return (
    <main className="landing">
      <picture>
        <source media="(max-width: 600px)" srcSet="both-mobile.svg" />
        <img src="both.svg" alt="" />
      </picture>
    </main>
  );
}
