"use client"

import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchProfileViewDetails } from '@/lib/actions/user.actions';


type TotalViewProfileByDateProps = {
    userId: string | null;
    startDate: Date | null;
    endDate: Date | null;
}

export function TotalViewProfileByDate({ userId, startDate, endDate }: TotalViewProfileByDateProps) {

    const [chartData, setChartData] = useState<any[]>([]);

    useEffect(() => {

        if(!userId) return;
        
        const fetchData = async () => {
            const response = await fetchProfileViewDetails(userId, startDate, endDate);
            
            if(response.success){
                setChartData(response.data || []);
            }else{ 
                setChartData([]);
            }
        }

        fetchData();
    }, [userId]);

    if(chartData.length === 0) {
        return (
            <div className="text-center text-gray-500 min-h-[300px] content-center">No data available</div>
        )
    }else{
        return (
            <ResponsiveContainer width="100%" minHeight={300}>
                <LineChart data={chartData}>
                    <XAxis dataKey="date" />
                    <YAxis
                        tickFormatter={tick => tick.toString()}
                    />
                    <Tooltip 
                        contentStyle={{ background: "#151c2c", border: "none", borderRadius: "15px" }} 
                        formatter={(value, name, props) => [
                            `${value} views`,
                            `Date: ${props.payload.date}`
                        ]}
                    />
                    <Line
                        dot={false}
                        dataKey="totalViews"
                        type="monotone"
                        name="Total Views"
                        stroke="#8884d8"
                    />
                </LineChart>
            </ResponsiveContainer>
        );
    }
}

