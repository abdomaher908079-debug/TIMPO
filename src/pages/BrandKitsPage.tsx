import BrandKits from '../components/BrandKits';

// Brand kits on their own page (menu → Brand kits): your show's caption look and logo.
export default function BrandKitsPage() {
  return (
    <main className="account-page">
      <h1 className="page-title">Brand kits</h1>
      <BrandKits onOwnPage />
    </main>
  );
}
