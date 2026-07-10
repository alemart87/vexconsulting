/** @type {import('tailwindcss').Config}
 *
 * Paleta oficial Voicenter (Manual de Identidad Visual, p.6):
 *  - Rojo principal   #E6332A (Pantone 485C)
 *  - Cyan/Turquesa    #00B2BF (Pantone 7466C)
 *  - Púrpura          #662483 (Pantone 526C)
 *  - Naranja          #F39200 (Pantone 144C)
 *
 * Tipografías oficiales:
 *  - Titulares: DIN  → fallback Google Fonts: Barlow Condensed
 *  - Texto corrido: Gilroy → fallback Google Fonts: Manrope
 */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // Color corporativo principal
          primary: "#E6332A",
          "primary-dark": "#B81F18",
          "primary-light": "#FDECEB",

          // Secundarios oficiales
          cyan: "#00B2BF",
          purple: "#662483",
          orange: "#F39200",

          // Neutros corporativos (escala fría sutil)
          ink: "#0F1116",       // Negro corporativo (titulares)
          graphite: "#2A2F3A",  // Texto fuerte
          slate: "#5B6275",     // Texto secundario
          mist: "#9CA3AF",      // Placeholder / disabled
          border: "#E5E7EB",
          surface: "#FFFFFF",
          bg: "#F6F7FB",        // Fondo de la app
          "bg-soft": "#FAFBFE",
        },
      },
      fontFamily: {
        // Sans corporativa (texto) — Gilroy substitute
        sans: ["Manrope", "system-ui", "Segoe UI", "Arial", "sans-serif"],
        // Display (titulares) — DIN substitute
        display: ['"Barlow Condensed"', "Impact", "Arial Narrow", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15,17,22,0.04), 0 1px 3px rgba(15,17,22,0.06)",
        elevated: "0 4px 12px rgba(15,17,22,0.08), 0 2px 4px rgba(15,17,22,0.04)",
        focus: "0 0 0 3px rgba(230,51,42,0.18)",
      },
      letterSpacing: {
        wider2: "0.08em",
      },
    },
  },
  plugins: [],
};
