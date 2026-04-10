#!/bin/bash

# --- 1. SET YOUR FOLDER NAMES AND SETTINGS HERE ---
relativeSourceFolder="/packs/" # The name of the folder containing your source images
relativeOutputFolder="/packs/webp/"  # The name of the folder where resized images will be saved
resizeWidth=400      # Desired width. Use 0 to resize by height instead.
resizeHeight=600     # Desired height. Use 0 to resize by width instead.
quality=75           # Quality for the WebP output (0-100)

# --- 2. SCRIPT LOGIC (No changes needed below) ---

# Get the directory where this script is located
scriptPath="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Combine the script's path with the relative folder names to create the full, absolute paths
sourceFolder="${scriptPath}/${relativeSourceFolder}"
outputFolder="${scriptPath}/${relativeOutputFolder}"

echo "Script Path: $scriptPath"
echo "Source folder: $sourceFolder"
echo "Output folder: $outputFolder"

# Check if the source folder exists
if [ ! -d "$sourceFolder" ]; then
    echo "Error: Source folder not found at: $sourceFolder" >&2
    exit 1
fi

echo "Source folder exists and is accessible"

# Check if the output folder exists, if not, create it.
if [ ! -d "$outputFolder" ]; then
    echo "Output folder not found. Creating it now: $outputFolder"
    mkdir -p "$outputFolder"
fi

# Check if cwebp is installed
if ! command -v cwebp &> /dev/null; then
    echo "Error: cwebp is not installed. Please install it first:" >&2
    echo "  brew install webp" >&2
    exit 1
fi

# Get all JPG, PNG, JPEG, and TIFF files from the source folder
echo "Searching for images in: $sourceFolder"

# Find images with case-insensitive extensions
images=($(find "$sourceFolder" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.png" -o -iname "*.jpeg" -o -iname "*.tiff" \)))

echo "Found ${#images[@]} images to process..."

if [ ${#images[@]} -eq 0 ]; then
    echo "Warning: No images found in the source folder to process."
    exit 0
fi

# Loop through each image
for image in "${images[@]}"; do
    # Get the base name without extension
    baseName=$(basename "$image" | sed 's/\.[^.]*$//')
    outputFile="${outputFolder}${baseName}.webp"
    
    echo "Converting: $(basename "$image") -> ${baseName}.webp"
    
    # Run the cwebp command
    cwebp -q "$quality" -resize "$resizeWidth" "$resizeHeight" "$image" -o "$outputFile"
done

echo "Batch conversion complete!"
