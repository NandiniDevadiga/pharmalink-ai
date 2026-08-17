import random
import sys
import os
import bcrypt
import datetime
import pandas as pd

# Add parent directory to path so we can import from database
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import db

def generate_dummy_data():
    print("Cleaning up old dummy data...")
    # Delete pharmacies with ID PH19 to PH38 and their stock & user accounts & transactions
    dummy_ids = [f"PH{i}" for i in range(19, 39)]
    db.pharmacies.delete_many({"pharmacy_id": {"$in": dummy_ids}})
    db.stock.delete_many({"pharmacy_id": {"$in": dummy_ids}})
    db.users.delete_many({"pharmacy_id": {"$in": dummy_ids}})
    db.sales_transactions.delete_many({"pharmacy_id": {"$in": dummy_ids}})
    print("Cleanup complete.")

    print("Generating dummy pharmacies...")
    
    # 1. Fetch medicines from local CSV catalog (contains 439 real drugs)
    csv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "real_medicine_catalog.csv")
    if os.path.exists(csv_path):
        print(f"Loading medicines from CSV: {csv_path}")
        df_catalog = pd.read_csv(csv_path)
        catalog = df_catalog.to_dict('records')
    else:
        print("Warning: CSV not found. Using fallback catalog...")
        catalog = [
            {"drug_name": "Paracetamol 500mg", "category": "Analgesic", "manufacturer": "GSK", "unit_price_inr": 15.0, "otc_or_rx": "OTC"},
            {"drug_name": "Crocin 650mg", "category": "Analgesic", "manufacturer": "Glaxo", "unit_price_inr": 20.0, "otc_or_rx": "OTC"},
            {"drug_name": "Metformin 500mg", "category": "Antidiabetic", "manufacturer": "Abbott", "unit_price_inr": 12.0, "otc_or_rx": "Rx"},
            {"drug_name": "Keto Cream", "category": "Dermatological", "manufacturer": "Tas Med", "unit_price_inr": 110.0, "otc_or_rx": "OTC"},
            {"drug_name": "Allyzole Cream", "category": "Dermatological", "manufacturer": "Azol", "unit_price_inr": 95.0, "otc_or_rx": "OTC"},
        ]

    # We want dummy IDs to start at PH19
    max_id = 18

    # 10 Mumbai Western Pharmacies
    mumbai_areas = ["Bandra", "Andheri", "Kandivali", "Borivali", "Malad", "Santacruz", "Vile Parle", "Khar", "Goregaon", "Dahisar"]
    mumbai_pharmacies = []
    
    # 10 Dubai Pharmacies (Near Middlesex University Dubai: 25.1039, 55.1633)
    dubai_areas = ["Dubai Knowledge Park", "Dubai Internet City", "Dubai Media City", "Al Sufouh", "Dubai Marina", "Jumeirah Lake Towers", "Barsha Heights", "Al Barsha", "Palm Jumeirah", "Jumeirah"]
    dubai_pharmacies = []
    
    # Generate Mumbai
    for i in range(10):
        max_id += 1
        pharm_id = f"PH{max_id}"
        area = mumbai_areas[i]
        lat = round(19.05 + random.random() * 0.1, 4)
        lng = round(72.82 + random.random() * 0.06, 4)
        
        mumbai_pharmacies.append({
            "pharmacy_id": pharm_id,
            "pharmacy_name": f"{area} Western Pharmacy",
            "area": area.upper(),
            "latitude": lat,
            "longitude": lng,
            "address": f"Shop No {random.randint(1,50)}, Link Road, {area}, Mumbai, India",
            "pharmacist_name": f"Pharmacist {area}",
            "contact_number": f"98200{random.randint(10000, 99999)}",
            "open_time": "08:00",
            "close_time": "22:00"
        })

    # Generate Dubai
    for i in range(10):
        max_id += 1
        pharm_id = f"PH{max_id}"
        area = dubai_areas[i]
        lat = round(25.1039 + (random.random() - 0.5) * 0.02, 4)
        lng = round(55.1633 + (random.random() - 0.5) * 0.02, 4)
        
        dubai_pharmacies.append({
            "pharmacy_id": pharm_id,
            "pharmacy_name": f"{area} Community Pharmacy",
            "area": area.upper(),
            "latitude": lat,
            "longitude": lng,
            "address": f"Block {random.randint(1,15)}, {area}, Dubai, UAE (Near Middlesex University)",
            "pharmacist_name": f"Dr. {area.split()[0]}",
            "contact_number": f"9714{random.randint(1000000, 9999999)}",
            "open_time": "08:00",
            "close_time": "22:00"
        })

    all_new_pharmacies = mumbai_pharmacies + dubai_pharmacies
    
    # Insert pharmacies
    db.pharmacies.insert_many(all_new_pharmacies)
    print(f"Successfully inserted {len(all_new_pharmacies)} pharmacies into db.pharmacies.")

    # Create fake stock for each new pharmacy (with randomized formulation count and low stock scenarios)
    stock_records = []
    pharmacy_stocks = {} # Maps pharm_id -> list of selected medicines
    for p in all_new_pharmacies:
        # Choose a random number of medicines (between 70 and 130) for this pharmacy
        num_meds = random.randint(70, 130)
        selected_meds = random.sample(catalog, min(len(catalog), num_meds))
        pharmacy_stocks[p["pharmacy_id"]] = selected_meds
        for m in selected_meds:
            # 15% chance of being low stock (1 to 40 units) for testing
            if random.random() < 0.15:
                stock_qty = random.randint(1, 40)
            else:
                stock_qty = random.randint(100, 1000)

            unit_price = m.get("unit_price_inr", 50.0)
            unit_cost = round(unit_price * random.uniform(0.65, 0.8), 2)

            stock_records.append({
                "drug_name": m["drug_name"],
                "pharmacy_id": p["pharmacy_id"],
                "category": m.get("category", "Other"),
                "manufacturer": m.get("manufacturer", "Unknown"),
                "otc_or_rx": m.get("otc_or_rx", "OTC"),
                "pharmacy_name": p["pharmacy_name"],
                "stock_qty": stock_qty,
                "unit_price_inr": unit_price,
                "unit_cost_inr": unit_cost
            })

    db.stock.insert_many(stock_records)
    print(f"Successfully generated stock records for all new branches (Total: {len(stock_records)} items with higher quantities).")

    # Create user accounts for each new pharmacy so they show up in Account Management!
    print("Hashing passwords and creating user accounts...")
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    pwhash = bcrypt.hashpw("pharma123".encode(), bcrypt.gensalt()).decode()
    
    user_records = []
    for p in all_new_pharmacies:
        user_records.append({
            "username": p["pharmacy_id"].lower(),  # e.g. ph19
            "password_hash": pwhash,
            "role": "pharmacy",
            "pharmacy_id": p["pharmacy_id"],
            "pharmacy_name": p["pharmacy_name"],
            "created_at": now_iso,
            "last_login_at": None,
            "last_login_ip": None,
            "active": True
        })
        
    db.users.insert_many(user_records)
    print(f"Successfully created {len(user_records)} user logins in db.users.")

    # Create fake sales transactions for each pharmacy over the last 6 months (March to August 2026)
    print("Generating fake sales transactions...")
    sales_records = []
    start_date = datetime.date(2026, 3, 1)
    end_date = datetime.date(2026, 8, 17)
    delta_days = (end_date - start_date).days

    transaction_id_counter = 100000
    for p in all_new_pharmacies:
        # Generate 150 transactions per pharmacy
        for _ in range(150):
            transaction_id_counter += 1
            # Random date in range
            rand_days = random.randint(0, delta_days)
            date_val = start_date + datetime.timedelta(days=rand_days)
            date_str = date_val.strftime("%Y-%m-%d")
            time_str = f"{random.randint(9, 21):02d}:{random.randint(0, 59):02d}:{random.randint(0, 59):02d}"
            timestamp_str = f"{date_str}T{time_str}+05:30"
            
            # 1 to 4 items in this transaction
            num_items = random.randint(1, 4)
            selected_meds = random.sample(pharmacy_stocks[p["pharmacy_id"]], num_items)
            for m in selected_meds:
                qty = random.randint(1, 5)
                unit_price = m.get("unit_price_inr", 50.0)
                unit_cost = round(unit_price * random.uniform(0.65, 0.8), 2)
                total_inr = round(qty * unit_price, 2)
                total_cost_inr = round(qty * unit_cost, 2)
                
                sales_records.append({
                    "transaction_id": f"TRX-{transaction_id_counter}",
                    "date": date_str,
                    "timestamp": timestamp_str,
                    "pharmacy_id": p["pharmacy_id"],
                    "pharmacy_name": p["pharmacy_name"],
                    "drug_name": m["drug_name"],
                    "category": m.get("category", "Other"),
                    "manufacturer": m.get("manufacturer", "Unknown"),
                    "otc_or_rx": m.get("otc_or_rx", "OTC"),
                    "quantity": qty,
                    "unit_price_inr": unit_price,
                    "unit_cost_inr": unit_cost,
                    "total_inr": total_inr,
                    "total_cost_inr": total_cost_inr
                })

    db.sales_transactions.insert_many(sales_records)
    print(f"Successfully generated {len(sales_records)} sales transactions for analytics dashboard!")

if __name__ == "__main__":
    generate_dummy_data()
