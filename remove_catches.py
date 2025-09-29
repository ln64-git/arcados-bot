import re

# Read the VoiceManager file
with open('src/features/vocie-manager/VoiceManager.ts', 'r') as f:
    content = f.read()

# Remove try-catch blocks that only have comments in the catch
# Pattern: try { ... } catch (_error) { // comment }

# First, let's find and remove simple try-catch blocks with only comments
lines = content.split('\n')
cleaned_lines = []
i = 0

while i < len(lines):
    line = lines[i]
    
    # Check if this line starts a try block
    if re.match(r'^\s*try\s*\{', line):
        # Find the matching catch block
        try_start = i
        brace_count = 0
        in_try = True
        
        # Count braces to find the end of try block
        for j in range(i, len(lines)):
            current_line = lines[j]
            brace_count += current_line.count('{') - current_line.count('}')
            
            if brace_count == 0 and '{' in current_line:
                # Found the end of try block, look for catch
                if j + 1 < len(lines) and 'catch' in lines[j + 1]:
                    catch_line = lines[j + 1]
                    if re.match(r'^\s*\}\s*catch\s*\([^)]*\)\s*\{', catch_line):
                        # Check if catch block only has comments
                        catch_start = j + 1
                        catch_brace_count = 0
                        catch_content = []
                        
                        # Collect catch block content
                        for k in range(catch_start, len(lines)):
                            catch_line_content = lines[k]
                            catch_brace_count += catch_line_content.count('{') - catch_line_content.count('}')
                            catch_content.append(catch_line_content)
                            
                            if catch_brace_count == 0 and '}' in catch_line_content:
                                # End of catch block
                                catch_end = k
                                
                                # Check if catch only contains comments
                                catch_body = '\n'.join(catch_content[1:-1])  # Skip first and last lines
                                if re.match(r'^\s*(//.*\s*)*$', catch_body.strip()):
                                    # Only comments in catch block - remove the entire try-catch
                                    # Keep only the try block content
                                    try_content = []
                                    for l in range(try_start, j + 1):
                                        try_line = lines[l]
                                        if l == try_start:
                                            # Remove 'try {' from first line
                                            try_line = re.sub(r'^\s*try\s*\{', '', try_line)
                                        if l == j:
                                            # Remove '}' from last line
                                            try_line = re.sub(r'\}\s*$', '', try_line)
                                        try_content.append(try_line)
                                    
                                    # Add the cleaned try content
                                    cleaned_lines.extend(try_content)
                                    i = catch_end + 1
                                    break
                                else:
                                    # Keep the try-catch as is
                                    for l in range(try_start, catch_end + 1):
                                        cleaned_lines.append(lines[l])
                                    i = catch_end + 1
                                    break
                        else:
                            # Keep the try block as is
                            cleaned_lines.append(line)
                            i += 1
                            break
                    else:
                        # Keep the try block as is
                        cleaned_lines.append(line)
                        i += 1
                        break
                else:
                    # Keep the try block as is
                    cleaned_lines.append(line)
                    i += 1
                    break
            elif j == len(lines) - 1:
                # End of file, keep the try block
                cleaned_lines.append(line)
                i += 1
                break
    else:
        cleaned_lines.append(line)
        i += 1

# Write back the cleaned content
with open('src/features/vocie-manager/VoiceManager.ts', 'w') as f:
    f.write('\n'.join(cleaned_lines))

print("Removed empty catch blocks from VoiceManager.ts")
