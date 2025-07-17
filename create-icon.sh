#!/bin/bash

# Create app icon using SF Symbol photo.badge.arrow.down.fill
# This creates a brutalist, clean icon perfect for the app

ICON_DIR="src-tauri/icons"
TEMP_DIR="temp-icons"

# Create directories
mkdir -p "$TEMP_DIR"

# Create a simple SVG with the SF Symbol concept
cat > "$TEMP_DIR/icon.svg" << 'EOF'
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="512" height="512" fill="#000000"/>
  
  <!-- Photo frame (white square) -->
  <rect x="96" y="96" width="320" height="320" fill="#ffffff" stroke="none"/>
  
  <!-- Inner photo area (light gray) -->
  <rect x="128" y="128" width="256" height="256" fill="#f0f0f0" stroke="none"/>
  
  <!-- Download arrow (black, bold) -->
  <path d="M256 200 L256 320 M216 280 L256 320 L296 280" 
        stroke="#000000" 
        stroke-width="24" 
        stroke-linecap="round" 
        stroke-linejoin="round" 
        fill="none"/>
  
  <!-- Badge circle (bottom right) -->
  <circle cx="380" cy="380" r="40" fill="#000000"/>
  
  <!-- Badge arrow (white) -->
  <path d="M380 360 L380 400 M365 385 L380 400 L395 385" 
        stroke="#ffffff" 
        stroke-width="6" 
        stroke-linecap="round" 
        stroke-linejoin="round" 
        fill="none"/>
</svg>
EOF

# Convert SVG to PNG at different sizes
for size in 32 128 256 512; do
    echo "Creating ${size}x${size} icon..."
    
    # Use rsvg-convert if available, otherwise use built-in conversion
    if command -v rsvg-convert &> /dev/null; then
        rsvg-convert -w $size -h $size "$TEMP_DIR/icon.svg" -o "$TEMP_DIR/icon-${size}.png"
    else
        # Fallback: use qlmanage to convert
        qlmanage -t -s $size -o "$TEMP_DIR" "$TEMP_DIR/icon.svg" 2>/dev/null || {
            echo "Creating simple ${size}x${size} black square as fallback..."
            # Create a simple black square with white border as fallback
            sips -z $size $size /System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns -o "$TEMP_DIR/icon-${size}.png" 2>/dev/null || {
                # Ultimate fallback: create with convert if available
                if command -v convert &> /dev/null; then
                    convert -size ${size}x${size} xc:black "$TEMP_DIR/icon-${size}.png"
                else
                    echo "Warning: Could not create icon at size $size"
                fi
            }
        }
    fi
done

# Copy to the correct locations
cp "$TEMP_DIR/icon-32.png" "$ICON_DIR/32x32.png" 2>/dev/null || echo "Warning: Could not copy 32x32 icon"
cp "$TEMP_DIR/icon-128.png" "$ICON_DIR/128x128.png" 2>/dev/null || echo "Warning: Could not copy 128x128 icon"
cp "$TEMP_DIR/icon-256.png" "$ICON_DIR/128x128@2x.png" 2>/dev/null || echo "Warning: Could not copy 128x128@2x icon"
cp "$TEMP_DIR/icon-512.png" "$ICON_DIR/icon.png" 2>/dev/null || echo "Warning: Could not copy icon.png"

# Create .icns file for macOS
if [ -f "$TEMP_DIR/icon-512.png" ]; then
    echo "Creating .icns file..."
    
    # Create iconset directory
    mkdir -p "$TEMP_DIR/icon.iconset"
    
    # Copy different sizes to iconset
    cp "$TEMP_DIR/icon-32.png" "$TEMP_DIR/icon.iconset/icon_16x16@2x.png" 2>/dev/null
    cp "$TEMP_DIR/icon-32.png" "$TEMP_DIR/icon.iconset/icon_32x32.png" 2>/dev/null
    cp "$TEMP_DIR/icon-128.png" "$TEMP_DIR/icon.iconset/icon_64x64@2x.png" 2>/dev/null
    cp "$TEMP_DIR/icon-128.png" "$TEMP_DIR/icon.iconset/icon_128x128.png" 2>/dev/null
    cp "$TEMP_DIR/icon-256.png" "$TEMP_DIR/icon.iconset/icon_128x128@2x.png" 2>/dev/null
    cp "$TEMP_DIR/icon-256.png" "$TEMP_DIR/icon.iconset/icon_256x256.png" 2>/dev/null
    cp "$TEMP_DIR/icon-512.png" "$TEMP_DIR/icon.iconset/icon_256x256@2x.png" 2>/dev/null
    cp "$TEMP_DIR/icon-512.png" "$TEMP_DIR/icon.iconset/icon_512x512.png" 2>/dev/null
    
    # Create .icns file
    iconutil -c icns "$TEMP_DIR/icon.iconset" -o "$ICON_DIR/icon.icns"
    
    echo "✓ Created icon.icns"
fi

# Clean up
rm -rf "$TEMP_DIR"

echo "✓ Icon generation complete!"
echo "Icons created in: $ICON_DIR"
echo "The icon uses a brutalist design with:"
echo "  - Black background"
echo "  - White photo frame"
echo "  - Bold download arrow"
echo "  - Badge indicating download action"