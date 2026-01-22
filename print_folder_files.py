import os


def list_files_and_print_contents(relative_paths, excluded_items=None):
    """
    Recursively lists all files in the specified folders (or individual files) relative to the current working directory
    and writes the content of each file to an output file, excluding files with certain extensions or folder names.

    Args:
    relative_paths (list): List of relative paths to folders or files from the current working directory.
    excluded_items (list): List of file extensions, folder names, and specific file names to exclude.
    """
    if excluded_items is None:
        excluded_items = []

    output_file = "print_folder_files_output.txt"

    # Open the output file in write mode (this will overwrite the file if it exists)
    with open(output_file, "w", encoding="utf-8") as out_file:
        for relative_path in relative_paths:
            # Get the absolute path
            abs_path = os.path.join(os.getcwd(), relative_path)
            print(abs_path)
            # Check if the path is a file
            if os.path.isfile(abs_path):
                file_name = os.path.basename(abs_path)
                file_extension = os.path.splitext(file_name)[1]

                # Process the single file if it's not excluded by extension or name
                if (
                    file_extension not in excluded_items
                    and file_name not in excluded_items
                ):
                    process_file(abs_path, out_file)
            elif os.path.isdir(abs_path):
                # Process directories and their files
                for root, dirs, files in os.walk(abs_path):
                    # Modify dirs in-place to skip excluded folders
                    dirs[:] = [d for d in dirs if d not in excluded_items]

                    for file in files:
                        file_path = os.path.join(root, file)
                        file_name = os.path.basename(file)
                        file_extension = os.path.splitext(file)[1]
                        folder_name = os.path.basename(root)

                        # Skip files with excluded extensions, specific file names, or if the current folder is excluded
                        if (
                            file_extension in excluded_items
                            or file_name in excluded_items
                            or folder_name in excluded_items
                        ):
                            continue

                        # Process the file
                        process_file(file_path, out_file)


def process_file(file_path, out_file):
    """
    Processes a single file by reading its contents and writing it to the output file.

    Args:
    file_path (str): Absolute path to the file.
    out_file (file object): Output file object to write to.
    """
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.readlines()
            total_lines = len(content)

            # File metadata
            file_name = os.path.basename(file_path)
            file_extension = os.path.splitext(file_name)[1]

            # Write header to the output file
            out_file.write(f"\n{'-'*80}\n")
            out_file.write(f"NEW FILE: {file_path}\n")
            out_file.write(f"TOTAL LINES: {total_lines}\n")
            out_file.write(f"FILE NAME: {file_name}\n")
            out_file.write(f"FILE EXTENSION: {file_extension}\n")
            out_file.write(f"{'-'*80}\n")

            # Write file content to the output file
            out_file.writelines(content)
    except Exception as e:
        out_file.write(f"Error reading {file_path}: {e}\n")


# Define the list of relative folder paths and/or file paths
relative_paths = [
    "src/",
    "workflows/staffbotics.json",
    "data/",
    "docker-compose.yml",
    "import-overwrite.sh",
    "README.md",
    "scripts/",
    "entrypoint.sh",

]

# Define the list of excluded file extensions and folder names
excluded_extensions = [
    "print_folder_files.py",    
    "print_folder_files_output.txt",
    "db"

]

list_files_and_print_contents(relative_paths, excluded_extensions)
