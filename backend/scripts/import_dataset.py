import pandas as pd
import requests
import io
import sys
import os

# Add parent directory to path so we can import from backend
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import db

DATA_URL = "https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/main/DATA/indian_medicine_data.csv"

def import_dataset():
    print("Downloading dataset from GitHub...")
    response = requests.get(DATA_URL)
    response.raise_for_status()
    
    print("Reading CSV data...")
    # The dataset has many columns, we only need a few
    df = pd.read_csv(io.StringIO(response.text))
    
    # Check the columns
    print(f"Columns found: {[c.encode('ascii', 'ignore').decode() for c in df.columns]}")
    
    # We want drug_name and composition
    # Let's map column names. The repo states it has name, price, manufacturer, type, pack_size, composition
    # We'll normalize names
    if 'name' in df.columns and 'short_composition1' in df.columns:
        df = df.rename(columns={'name': 'drug_name', 'short_composition1': 'composition'})
    elif 'name' in df.columns and 'composition' not in df.columns:
        print("Warning: composition column might be missing. Using whatever is available.")
        # Try to find composition column
        for col in df.columns:
            if 'comp' in col.lower() or 'salt' in col.lower():
                df = df.rename(columns={col: 'composition'})
                break

    if 'drug_name' not in df.columns:
        if 'name' in df.columns:
            df = df.rename(columns={'name': 'drug_name'})
        else:
            df = df.rename(columns={df.columns[0]: 'drug_name'})

    if 'composition' not in df.columns:
        print("Error: Could not find composition column!")
        print(df.head())
        return

    # Keep only needed columns and drop NAs
    df = df[['drug_name', 'composition']].dropna(subset=['composition'])
    df['drug_name'] = df['drug_name'].astype(str).str.lower().str.strip()
    df['composition'] = df['composition'].astype(str).str.lower().str.strip()
    
    print(f"Processing {len(df)} medicines...")
    
    # Convert to dict for mongodb
    records = df.to_dict('records')
    
    collection = db['medicine_compositions']
    print("Dropping existing collection...")
    collection.drop()
    
    print("Inserting into MongoDB...")
    # Batch insert
    batch_size = 5000
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        collection.insert_many(batch)
        print(f"Inserted {i + len(batch)}/{len(records)}")
        
    print("Done! Collection 'medicine_compositions' has been populated.")

if __name__ == "__main__":
    import_dataset()
