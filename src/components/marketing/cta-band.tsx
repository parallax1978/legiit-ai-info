import { SiteUrlForm } from "./site-url-form";

export function CtaBand({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="hero-dark">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:py-20">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          See what your site says about you
        </h2>
        <p className="mt-4 text-lg leading-8 text-white/75">
          Enter the address and get a fact sheet with a quote for every value, then the page.
        </p>
        <SiteUrlForm
          id="cta-site"
          signedIn={signedIn}
          className="mx-auto mt-8 max-w-xl sm:justify-center"
        />
      </div>
    </section>
  );
}
