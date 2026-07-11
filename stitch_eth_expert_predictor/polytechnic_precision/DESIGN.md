---
name: Polytechnic Precision
colors:
  surface: '#fcf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fcf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0eded'
  surface-container-high: '#eae7e7'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1b1c1c'
  on-surface-variant: '#434750'
  inverse-surface: '#303030'
  inverse-on-surface: '#f3f0ef'
  outline: '#747781'
  outline-variant: '#c4c6d1'
  surface-tint: '#3f5d99'
  primary: '#002961'
  on-primary: '#ffffff'
  primary-container: '#1f407a'
  on-primary-container: '#90adef'
  inverse-primary: '#aec6ff'
  secondary: '#495f86'
  on-secondary: '#ffffff'
  secondary-container: '#b9cffd'
  on-secondary-container: '#42587f'
  tertiary: '#202b46'
  on-tertiary: '#ffffff'
  tertiary-container: '#36415e'
  on-tertiary-container: '#a2adcf'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#aec6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#254580'
  secondary-fixed: '#d7e3ff'
  secondary-fixed-dim: '#b1c7f4'
  on-secondary-fixed: '#001b3e'
  on-secondary-fixed-variant: '#30476d'
  tertiary-fixed: '#dae2ff'
  tertiary-fixed-dim: '#bbc6e9'
  on-tertiary-fixed: '#0f1b35'
  on-tertiary-fixed-variant: '#3b4663'
  background: '#fcf9f8'
  on-background: '#1b1c1c'
  surface-variant: '#e5e2e1'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style
The design system is engineered for an academic environment that demands both institutional authority and modern technical clarity. The brand personality is intellectual, precise, and transparent, reflecting the rigorous standards of ETH Zurich. 

The aesthetic is a refined **Corporate Modern** style with **Minimalist** leanings. It prioritizes information density and legible data visualization over decorative elements. High whitespace, crisp linework, and a disciplined adherence to a grid structure ensure that complex voting data and academic content remain accessible and objective. The emotional response should be one of trust, stability, and functional efficiency.

## Colors
The palette is rooted in the official ETH Blue, serving as the primary anchor for navigation, primary actions, and institutional branding. 

- **Primary (#1F407A):** Used for key structural elements, headers, and primary buttons.
- **Success & Error:** Specifically tuned for voting contexts; Success Green signifies affirmative votes and completed states, while Alert Red marks negative votes or critical system errors.
- **Neutrals:** A range of cool grays provides soft contrast for background layering and subtle borders, maintaining a clean, "paper-like" feel.
- **Data Visualization:** Use the primary blue as the base, extending into secondary and tertiary tints for multi-series charts to maintain monochromatic harmony.

## Typography
This design system utilizes **Inter** for all UI and prose elements to ensure maximum legibility across digital interfaces. Its tall x-height and neutral character support the system's professional tone. 

To introduce a technical/data-centric edge, **JetBrains Mono** is employed for labels, data points, and metadata. This monospaced secondary font reinforces the "polytechnic" nature of the project, making tabular data and voting tallies easier to scan and compare. 

Heading weights should stay within the SemiBold (600) to Bold (700) range to maintain a clear hierarchy against the Regular (400) body text.

## Layout & Spacing
The layout follows a **Fixed Grid** philosophy on desktop to maintain the structural integrity of complex data views, transitioning to a fluid model on mobile devices.

- **Grid:** A 12-column grid is used for desktop (1280px max-width).
- **Rhythm:** An 8px baseline grid (derived from a 4px base unit) governs all vertical spacing. 
- **Data Views:** Use generous 24px gutters between columns to prevent information density from feeling overwhelming.
- **Responsive Behavior:** On tablet, the grid shifts to 8 columns. On mobile, elements stack into a single column with 16px side margins to maximize reading area for long-form academic descriptions.

## Elevation & Depth
This design system avoids heavy shadows, opting instead for **Tonal Layers** and **Low-Contrast Outlines** to define hierarchy.

- **Surface Levels:** The base background is white (#FFFFFF). Secondary containers (like sidebars or data cards) use a subtle gray wash (#F9FAFB) with a 1px solid border (#E5E7EB).
- **Interactive Depth:** Only the highest priority elements (like active voting modals) utilize an elevation effect: a very soft, "ambient" shadow (0px 4px 20px rgba(0, 0, 0, 0.05)).
- **Focus States:** Use the ETH Blue (#1F407A) for high-contrast 2px outlines on interactive elements to ensure accessibility and clear navigational focus.

## Shapes
In line with the technical and institutional nature of the project, shapes are kept disciplined and "Soft" rather than "Rounded." 

- **Standard Radius:** 4px (0.25rem) for buttons, input fields, and small cards. This provides a hint of modernity without sacrificing the professional, serious tone of the interface.
- **Large Components:** Larger layout containers may use up to 8px (0.5rem) to distinguish them from smaller UI widgets.
- **Strictness:** Interactive elements should never be pill-shaped, as the system favors geometric precision over playful curves.

## Components

- **Buttons:** Primary buttons are solid ETH Blue with white text. Secondary buttons use a 1px border (#1F407A) with transparent backgrounds. Use the monospaced label-md font for button text to emphasize the "action/function" nature.
- **Data Visualization:** Charts should utilize a 1px "grid-line" style in light gray (#E5E7EB). Data points should use the Primary Blue or Success/Error colors. Labels for axes must be set in JetBrains Mono.
- **Voting Cards:** Distinct containers with a 1px border. The header should be ETH Blue (Primary), with clear Success (Green) and Error (Red) indicators for "Yes/No" or "In Favor/Against" states.
- **Input Fields:** Rectangular with a 1px border. The focus state uses a 2px Primary Blue stroke. Labels are placed above the field in monospaced font.
- **Chips/Status Tags:** Small, rectangular tags with 2px radius. Use light tints of success/error colors with dark text for status (e.g., "Active," "Closed," "Verified").
- **Tables:** Academic data should be presented in clean tables with horizontal dividers only. Header rows use a light gray background wash and bold monospaced text.