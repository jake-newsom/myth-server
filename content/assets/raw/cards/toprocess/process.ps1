# --- 1. SET YOUR FOLDER NAMES AND SETTINGS HERE ---
$relativeSourceFolder = "../norse/rare/" # The name of the folder containing your source images
$relativeOutputFolder = "../norse/rare/"  # The name of the folder where resized images will be saved
$resizeWidth          = 400      # Desired width. Use 0 to resize by height instead.
$resizeHeight         = 600         # Desired height. Use 0 to resize by width instead.
$quality              = 75        # Quality for the WebP output (0-100)

# --- 2. SCRIPT LOGIC (No changes needed below) ---

# Get the directory where this script is located
$scriptPath = $PSScriptRoot

# Combine the script's path with the relative folder names to create the full, absolute paths
$sourceFolder = Join-Path -Path $scriptPath -ChildPath $relativeSourceFolder
$outputFolder = Join-Path -Path $scriptPath -ChildPath $relativeOutputFolder

Write-Host "Script Path: $scriptPath"
Write-Host "Source folder: $sourceFolder"
Write-Host "Output folder: $outputFolder"

# Check if the source folder exists
if (-not (Test-Path $sourceFolder)) {
    Write-Error "Source folder not found at: $sourceFolder"
    # The 'return' command stops the script here if the folder is missing.
    return 
}

Write-Host "Source folder exists and is accessible"

# Check if the output folder exists, if not, create it.
if (-not (Test-Path $outputFolder)) {
    Write-Host "Output folder not found. Creating it now: $outputFolder"
    New-Item -ItemType Directory -Force -Path $outputFolder
}

# Get all JPG, PNG, JPEG, and TIFF files from the source folder
Write-Host "Searching for images in: $sourceFolder"

# Fix: Use wildcard path with -Include
$images = Get-ChildItem -Path "$sourceFolder*" -Include *.jpg, *.png, *.jpeg, *.tiff -Force

Write-Host "Get-ChildItem completed"

if ($images.Count -eq 0) {
    Write-Warning "No images found in the source folder to process."
    return
}

Write-Host "Found $($images.Count) images to process..."

# Loop through each image
foreach ($image in $images) {
    $inputFile = $image.FullName
    $outputFile = Join-Path -Path $outputFolder -ChildPath ($image.BaseName + ".webp")

    Write-Host "Converting: $($image.Name) -> $($image.BaseName).webp"

    # Run the cwebp command
    cwebp -q $quality -resize $resizeWidth $resizeHeight "$inputFile" -o "$outputFile"
}

Write-Host "Batch conversion complete!"