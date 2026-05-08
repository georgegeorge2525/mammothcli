import os

def scan_folder_and_write_contents(output_file):
    # Get the directory where the script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    folder_path = script_dir  # Use the script's directory as the base folder
    file_count = 0

    # 1. Directories to completely skip
    exclude_dirs = {'build', 'node_modules', '.git', '.idea', '.gradle', 'gradle', 'lib', 'bin'}
    
    # 2. Exact file names to skip (even if they end in .kt or .xml)
    exclude_files = {'colors.xml', 'themes.xml', 'strings.xml', 'dimens.xml', 'network_security_config.xml'}
    
    # 3. Path patterns to skip (e.g., skip all files inside any 'drawable' or 'generated' folder)
    exclude_patterns = ['/drawable', '/mipmap', '/generated/', '/test/', '/androidTest/']

    # Use the absolute path for the output file
    output_file_path = os.path.join(script_dir, output_file)

    print(f"Scanning folder: {folder_path}")
    print(f"Writing output to: {output_file_path}")

    with open(output_file_path, 'w', encoding='utf-8') as outfile:
        for root, dirs, files in os.walk(folder_path, topdown=True):
            # Modify dirs in-place to prevent traversing excluded or hidden directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]

            for file in files:
                # Ignore hidden files, exact excluded files, and non-target extensions
                if file.startswith('.') or file in exclude_files:
                    continue
                
                if file.endswith(('')):
                    file_path = os.path.join(root, file)
                    relative_path = os.path.relpath(file_path, folder_path)
                    relative_path_normalized = relative_path.replace(os.sep, '/')

                    # Check if the file's path contains any of the excluded patterns
                    if any(pattern in relative_path_normalized for pattern in exclude_patterns):
                        continue

                    file_count += 1

                    try:
                        outfile.write(f"### File: {relative_path_normalized}\n")
                        with open(file_path, 'r', encoding='utf-8') as infile:
                            outfile.write(infile.read())
                        outfile.write("\n\n")
                    except UnicodeDecodeError:
                        try:
                            # Attempt reading with latin-1 as a fallback
                            with open(file_path, 'r', encoding='latin-1') as infile:
                                outfile.write(infile.read())
                            outfile.write("\n\n")
                            print(f"Warning: Read file {relative_path_normalized} with latin-1 encoding.")
                        except Exception as e:
                            outfile.write(f"### Error reading file: {relative_path_normalized} (Unsupported encoding)\n\n")
                            print(f"Skipped file {relative_path_normalized} due to encoding/read error: {e}")
                    except Exception as e:
                        outfile.write(f"### Error reading file: {relative_path_normalized} ({str(e)})\n\n")
                        print(f"Skipped file {relative_path_normalized} due to error: {e}")

                    # Print progress (less frequently to avoid spamming console)
                    if file_count % 50 == 0:
                        print(f"Processed {file_count} files...")

# Specify the output file name
output_txt_file = "combined_files_with_paths.txt"

# Run the script
scan_folder_and_write_contents(output_txt_file)

# Final confirmation message
final_output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), output_txt_file)
print(f"\nProcessing complete.")
print(f"All relevant .kt and .xml files have been written to {final_output_path}")