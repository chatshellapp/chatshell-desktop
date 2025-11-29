import { cn } from "@/lib/utils"

interface MorphSpinnerProps extends React.SVGProps<SVGSVGElement> {
  size?: number
}

function MorphSpinner({ className, size = 24, ...props }: MorphSpinnerProps) {
  // All shapes use exactly 4 cubic bezier curves for smooth morphing
  // Format: M startPoint C cp1 cp2 endPoint (x4) then Z
  // Centered at 50,50

  // Equilateral triangle (pointing up) with 4 control points for symmetric morphing
  // The bottom edge is split at center so it maps cleanly to diamond's 4 corners
  // Vertices: top (50,12), bottom-right (83,69), bottom-center (50,69), bottom-left (17,69)
  const triangle = [
    "M 50 12",              // Top vertex
    "C 50 12, 83 69, 83 69",   // Top to bottom-right
    "C 83 69, 50 69, 50 69",   // Bottom-right to bottom-center (flat edge)
    "C 50 69, 17 69, 17 69",   // Bottom-center to bottom-left (flat edge)
    "C 17 69, 50 12, 50 12",   // Bottom-left back to top
    "Z"
  ].join(" ")

  // Diamond (rotated square) - vertices map symmetrically from triangle
  // top (50,12), right (88,50), bottom (50,88), left (12,50)
  const square = [
    "M 50 12",              // Top
    "C 50 12, 88 50, 88 50",   // Top to right
    "C 88 50, 50 88, 50 88",   // Right to bottom
    "C 50 88, 12 50, 12 50",   // Bottom to left
    "C 12 50, 50 12, 50 12",   // Left back to top
    "Z"
  ].join(" ")

  // Circle (using bezier approximation with magic number 0.552)
  const k = 0.552 * 38 // bezier handle length for radius ~38
  const circle = [
    "M 50 12",           // Top
    `C ${50 + k} 12, 88 ${50 - k}, 88 50`, // Top to right (quarter circle)
    `C 88 ${50 + k}, ${50 + k} 88, 50 88`, // Right to bottom (quarter circle)
    `C ${50 - k} 88, 12 ${50 + k}, 12 50`, // Bottom to left (quarter circle)
    `C 12 ${50 - k}, ${50 - k} 12, 50 12`, // Left back to top (quarter circle)
    "Z"
  ].join(" ")

  // Colors
  const cyan = "#00E5FF"
  const pink = "#FF4081"
  const purple = "#E040FB"

  // Use different durations for shape and color to create all 9 combinations
  // Shape: 2.4s (3 shapes), Color: 3.6s (3 colors)
  // LCM = 7.2s, so all 9 combinations appear within one full cycle
  const shapeDuration = "2.4s"
  const colorDuration = "3.6s"
  const rotateDuration = "4.8s"

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("", className)}
      role="status"
      aria-label="Loading"
      {...props}
    >
      {/* Brand metadata */}
      <title>ChatShell Loading Spinner</title>
      <desc>
        A morphing shape spinner. Designed for ChatShell.
      </desc>
      <metadata>
        {`
          <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
                   xmlns:dc="http://purl.org/dc/elements/1.1/">
            <rdf:Description>
              <dc:title>ChatShell MorphSpinner</dc:title>
              <dc:creator>ChatShell Team</dc:creator>
              <dc:rights>Copyright © 2025 ChatShell</dc:rights>
              <dc:source>https://chatshell.app</dc:source>
            </rdf:Description>
          </rdf:RDF>
        `}
      </metadata>

      <defs>
        {/* Subtle glow filter */}
        <filter id="morphSpinnerGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g>
        {/* Main morphing shape */}
        <path
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#morphSpinnerGlow)"
        >
          {/* Shape morphing animation: triangle -> square -> circle -> triangle */}
          <animate
            attributeName="d"
            values={`${triangle};${square};${circle};${triangle}`}
            dur={shapeDuration}
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95"
            keyTimes="0; 0.33; 0.66; 1"
          />

          {/* Color animation: cyan -> pink -> purple -> cyan (different duration) */}
          <animate
            attributeName="stroke"
            values={`${cyan};${pink};${purple};${cyan}`}
            dur={colorDuration}
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95"
            keyTimes="0; 0.33; 0.66; 1"
          />
        </path>

        {/* Continuous rotation */}
        <animateTransform
          attributeName="transform"
          attributeType="XML"
          type="rotate"
          from="0 50 50"
          to="360 50 50"
          dur={rotateDuration}
          repeatCount="indefinite"
        />
      </g>
    </svg>
  )
}

export { MorphSpinner }
